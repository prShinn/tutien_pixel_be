package com.tutien.pixel.entities;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "canhGioi")
public class canhGioiEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Column(unique = true)
    private int stt;
    private String name;
    private int capDotPha;
    private int tuViDotPha;
    private String vatPhamDotPha;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public int getStt() {
        return stt;
    }

    public void setStt(int stt) {
        this.stt = stt;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getCapDotPha() {
        return capDotPha;
    }

    public void setCapDotPha(int capDotPha) {
        this.capDotPha = capDotPha;
    }

    public int getTuViDotPha() {
        return tuViDotPha;
    }

    public void setTuViDotPha(int tuViDotPha) {
        this.tuViDotPha = tuViDotPha;
    }

    public String getVatPhamDotPha() {
        return vatPhamDotPha;
    }

    public void setVatPhamDotPha(String vatPhamDotPha) {
        this.vatPhamDotPha = vatPhamDotPha;
    }
}
