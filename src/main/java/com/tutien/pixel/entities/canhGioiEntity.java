package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "canhGioi")
public class canhGioiEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Column(unique = true)
    private String code;
    private String name;
    private int daiCanhGioi;
    private int tuViTienCap;
    @Column(unique = true)
    private int stt;

    public int getDaiCanhGioi() {
        return daiCanhGioi;
    }

    public void setDaiCanhGioi(int daiCanhGioi) {
        this.daiCanhGioi = daiCanhGioi;
    }

    public int getTuViTienCap() {
        return tuViTienCap;
    }

    public void setTuViTienCap(int tuViTienCap) {
        this.tuViTienCap = tuViTienCap;
    }

    public int getStt() {
        return stt;
    }

    public void setStt(int stt) {
        this.stt = stt;
    }

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
}
