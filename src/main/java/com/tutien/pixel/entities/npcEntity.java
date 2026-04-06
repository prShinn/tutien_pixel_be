package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "npc")
public class npcEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String code;
    private String name;
    @Enumerated(EnumType.STRING)
    private loaiNpc loaiNpc;
    private int x;
    private int y;
    private String classCss;
    private String message;
    private String mapCode;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getMapCode() {
        return mapCode;
    }

    public void setMapCode(String mapCode) {
        this.mapCode = mapCode;
    }

    public com.tutien.pixel.entities.loaiNpc getLoaiNpc() {
        return loaiNpc;
    }

    public void setLoaiNpc(com.tutien.pixel.entities.loaiNpc loaiNpc) {
        this.loaiNpc = loaiNpc;
    }

    public int getX() {
        return x;
    }

    public void setX(int x) {
        this.x = x;
    }

    public int getY() {
        return y;
    }

    public void setY(int y) {
        this.y = y;
    }

    public String getClassCss() {
        return classCss;
    }

    public void setClassCss(String classCss) {
        this.classCss = classCss;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
