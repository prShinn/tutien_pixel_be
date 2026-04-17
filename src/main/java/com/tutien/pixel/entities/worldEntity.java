package com.tutien.pixel.entities;

import com.tutien.pixel.entities.enums.loaiMap;
import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "worlds")
public class worldEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String tenMap;
    @Column(unique = true)
    private String code;
    @Lob
    private String jsonMap;
    private int w;
    private int h;
    private int isDefault;
    @Enumerated(EnumType.STRING)
    private loaiMap loaiMap;

    public loaiMap getLoaiMap() {
        return loaiMap;
    }

    public void setLoaiMap(loaiMap loaiMap) {
        this.loaiMap = loaiMap;
    }

    public int getIsDefault() {
        return isDefault;
    }

    public void setIsDefault(int isDefault) {
        this.isDefault = isDefault;
    }

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getTenMap() {
        return tenMap;
    }

    public void setTenMap(String tenMap) {
        this.tenMap = tenMap;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getJsonMap() {
        return jsonMap;
    }

    public void setJsonMap(String jsonMap) {
        this.jsonMap = jsonMap;
    }

    public int getW() {
        return w;
    }

    public void setW(int w) {
        this.w = w;
    }

    public int getH() {
        return h;
    }

    public void setH(int h) {
        this.h = h;
    }
}
